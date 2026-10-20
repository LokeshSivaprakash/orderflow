# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# nginx serves the SPA and acts as the API gateway to the microservices.
FROM nginxinc/nginx-unprivileged:1.27-alpine
ENV AUTH_HOST=auth INVENTORY_HOST=inventory ORDERS_HOST=orders PAYMENTS_HOST=payments
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
