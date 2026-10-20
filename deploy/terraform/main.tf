data "aws_availability_zones" "available" { state = "available" }

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

# ---------------- Network ----------------
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  name = "${var.cluster_name}-vpc"
  cidr = "10.20.0.0/16"
  azs  = local.azs

  public_subnets   = ["10.20.0.0/24", "10.20.1.0/24"]
  private_subnets  = ["10.20.10.0/24", "10.20.11.0/24"]
  database_subnets = ["10.20.20.0/24", "10.20.21.0/24"]

  enable_nat_gateway = true
  single_nat_gateway = var.environment != "production" # cost saving outside prod

  # Tags the AWS Load Balancer Controller uses to discover subnets.
  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1 }
}

# ---------------- Container registry ----------------
resource "aws_ecr_repository" "svc" {
  for_each             = toset(["auth", "inventory", "orders", "payments", "web"])
  name                 = "orderflow/${each.key}"
  image_tag_mutability = "MUTABLE" # CI also pushes :latest
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "svc" {
  for_each   = aws_ecr_repository.svc
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ---------------- Kubernetes (EKS) ----------------
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = var.cluster_name
  cluster_version = "1.31"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = true
  enable_cluster_creator_admin_permissions = true

  eks_managed_node_groups = {
    default = {
      instance_types = var.node_instance_types
      min_size       = 2
      max_size       = 5
      desired_size   = 2
    }
  }
}

# ---------------- PostgreSQL (RDS) ----------------
resource "random_password" "db" {
  length  = 32
  special = false
}

resource "aws_security_group" "db" {
  name_prefix = "${var.cluster_name}-db-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Postgres from EKS worker nodes only"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
  lifecycle { create_before_destroy = true }
}

resource "aws_db_subnet_group" "db" {
  name       = "${var.cluster_name}-db"
  subnet_ids = module.vpc.database_subnets
}

resource "aws_db_instance" "postgres" {
  identifier                  = "${var.cluster_name}-postgres"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = var.db_instance_class
  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_encrypted           = true
  username                    = "orderflow"
  password                    = random_password.db.result
  db_subnet_group_name        = aws_db_subnet_group.db.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  multi_az                    = var.environment == "production"
  backup_retention_period     = var.environment == "production" ? 14 : 3
  deletion_protection         = var.environment == "production"
  skip_final_snapshot         = var.environment != "production"
  final_snapshot_identifier   = var.environment == "production" ? "${var.cluster_name}-final" : null
  auto_minor_version_upgrade  = true
  publicly_accessible         = false
}

# Store the generated password in Secrets Manager (read it from CI / External Secrets Operator).
resource "aws_secretsmanager_secret" "db" {
  name                    = "${var.cluster_name}/${var.environment}/db"
  recovery_window_in_days = var.environment == "production" ? 7 : 0
}

resource "aws_secretsmanager_secret_version" "db" {
  secret_id = aws_secretsmanager_secret.db.id
  secret_string = jsonencode({
    username = aws_db_instance.postgres.username
    password = random_password.db.result
    host     = aws_db_instance.postgres.address
    port     = 5432
  })
}
