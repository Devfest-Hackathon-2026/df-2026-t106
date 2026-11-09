# Cloud Run (CPU, asia-northeast1): Vertex AI gemini-embedding-001 + our logistic heads. No model weights
# in the image; the embedding runs on Vertex AI.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY heads.json main.py shared_ids.json ./
ENV HEADS_PATH=/app/heads.json PORT=8080
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
