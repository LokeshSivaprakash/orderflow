output "cluster_name" { value = module.eks.cluster_name }
output "configure_kubectl" { value = "aws eks update-kubeconfig --name ${module.eks.cluster_name} --region ${var.region}" }
output "ecr_repository_urls" { value = { for k, r in aws_ecr_repository.svc : k => r.repository_url } }
output "db_endpoint" { value = aws_db_instance.postgres.address }
output "db_secret_arn" { value = aws_secretsmanager_secret.db.arn }
