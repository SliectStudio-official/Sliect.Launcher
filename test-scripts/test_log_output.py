#!/usr/bin/env python3
"""Test script for Sliect Launcher log capture.
Add this as a project with:
  Command: python test_log_output.py
  WorkDir: E:\Sliect.Launcher\test-scripts
"""
import sys
import time
import random

levels = [
    ("INFO",  "Server started on port 3000"),
    ("INFO",  "Connected to database"),
    ("DEBUG", "Loading configuration from config.yaml"),
    ("DEBUG", "Cache initialized with 256MB limit"),
    ("WARN",  "Disk usage above 80%"),
    ("WARN",  "API rate limit approaching threshold"),
    ("ERROR", "Failed to connect to external service"),
    ("ERROR", "Database query timeout after 30s"),
    ("INFO",  "Processing batch job #42"),
    ("INFO",  "User authentication successful"),
    ("DEBUG", "Request payload size: 2.3KB"),
    ("WARN",  "Deprecated API endpoint called"),
    ("INFO",  "Health check passed"),
    ("ERROR", "Permission denied for resource /admin"),
    ("INFO",  "Scheduled backup completed"),
    ("DEBUG", "Memory usage: 128MB / 512MB"),
]

print(f"[INFO] Test script started (PID: {__import__('os').getpid()})", flush=True)
print(f"[INFO] Outputting log messages every 2 seconds...", flush=True)
print(f"[INFO] Press Ctrl+C or stop from Launcher to exit", flush=True)
print("", flush=True)

i = 0
try:
    while True:
        level, msg = levels[i % len(levels)]
        timestamp = time.strftime("%H:%M:%S")
        print(f"[{level}] {timestamp} - {msg}", flush=True)

        # Occasionally output to stderr
        if random.random() < 0.2:
            print(f"[WARN] {timestamp} - stderr: Random warning message", file=sys.stderr, flush=True)

        i += 1
        time.sleep(2)
except KeyboardInterrupt:
    print("[INFO] Received shutdown signal, exiting gracefully...", flush=True)
    time.sleep(0.5)
    print("[INFO] Cleanup complete. Goodbye!", flush=True)
