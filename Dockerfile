# Use official lightweight Python image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Set work directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install python dependencies
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend files
COPY backend /app/backend/

# Copy built frontend assets (for server-side hosting by FastAPI)
COPY frontend/dist /app/frontend/dist/

# Expose port
EXPOSE 8080

# Run uvicorn on container startup, dynamically binding to the port set by Cloud Run (defaulting to 8080)
CMD uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}
