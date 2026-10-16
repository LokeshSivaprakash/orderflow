# Terraform (AWS)

Provisions: VPC (public/private/database subnets), 4 ECR repos, EKS cluster + managed node group, RDS PostgreSQL 16 (private, encrypted), and a Secrets Manager entry for the DB credentials.

```bash
terraform init
terraform plan -var environment=staging
terraform apply -var environment=staging
```

After apply: create the three databases on the RDS instance (`orderflow_auth`, `orderflow_inventory`, `orderflow_orders`) from a pod inside the cluster, install the AWS Load Balancer Controller, create the `orderflow-secrets` Secret (see `../k8s/secret.template.yaml`), and let the GitLab pipeline deploy.

Note: this was written to match the module versions pinned in `main.tf` but could not be `terraform validate`d in the authoring sandbox. Run `terraform validate` and review `plan` output before applying. Resources cost money (NAT gateway, EKS control plane, nodes, RDS) - run `terraform destroy` when done.
