-- Database-per-service: each microservice owns its schema and never reads another service's tables.
CREATE DATABASE orderflow_auth;
CREATE DATABASE orderflow_inventory;
CREATE DATABASE orderflow_orders;
