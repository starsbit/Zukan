FROM python:3.12-slim

WORKDIR /backend

ENV PYTHONUNBUFFERED=1

ARG APP_VERSION=dev
ENV APP_VERSION=${APP_VERSION}

RUN apt-get update && apt-get install -y --no-install-recommends \
	ffmpeg \
	tesseract-ocr \
	tesseract-ocr-eng \
	&& rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

RUN mkdir -p storage model_cache

CMD ["uvicorn", "backend.app.main:api", "--host", "0.0.0.0", "--port", "8000", "--log-level", "info", "--access-log"]
