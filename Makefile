.PHONY: test up down
test:
	@for s in auth inventory orders; do (cd services/$$s && npm ci && npm test) || exit 1; done
	cd frontend && npm ci && npm test
up:
	docker compose up --build
down:
	docker compose down -v
