variable "region" {
  type    = string
  default = "us-east-1"
}
variable "environment" {
  type    = string
  default = "staging"
}
variable "cluster_name" {
  type    = string
  default = "orderflow"
}
variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}
variable "node_instance_types" {
  type    = list(string)
  default = ["t3.medium"]
}
