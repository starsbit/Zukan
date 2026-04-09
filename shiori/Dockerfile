FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1

COPY shiori/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shiori/ ./shiori/

RUN mkdir -p /data

CMD ["uvicorn", "shiori.app.main:app", "--host", "0.0.0.0", "--port", "8010", "--log-level", "info"]
