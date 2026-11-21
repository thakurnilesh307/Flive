# Flive in one container: builds the React app, then serves it and the live API with uvicorn.
#   docker build -t flive . && docker run -p 7860:7860 flive      -> http://localhost:7860
# Used by the Hugging Face Space (scripts/deploy_space.py) but works on any Docker host.
# The trained models (data/models/*.joblib) must exist locally; they are gitignored.

FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.11-slim
# Hugging Face runs containers as uid 1000; the server writes logs and a logo cache
# next to its code, so the app directory must belong to that user.
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH PYTHONUNBUFFERED=1
WORKDIR /home/user/app
# Same versions the models were trained and pickled with.
RUN pip install --no-cache-dir --user \
    fastapi==0.124.4 "uvicorn[standard]==0.38.0" requests python-dotenv \
    scikit-learn==1.6.1 numpy==1.26.4 pandas==2.2.3 joblib==1.5.0
COPY --chown=user . .
COPY --from=web --chown=user /web/dist frontend/dist
# Aircraft lookup table: downloaded fresh at build time, never stored in the repo.
RUN python scripts/build_aircraft_db.py
EXPOSE 7860
CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-7860}"]
