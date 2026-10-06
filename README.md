# WhenToMeet 2

Self-hosted web app to find the best time slot for a group's schedule, in the style of when2meet. You create an event with a range of dates and hours, share the link, and everyone paints their availability (Yes / Maybe / No). The results page shows a matrix with the aggregated scores.

Built with Flask and SQLite: no accounts, no external dependencies, and all data in a single file.

## Features

- Event creation with a date range (up to 60 days), hours and 15, 30 or 60-minute slots.
- Each participant only needs to type their name; they can come back and edit their availability later with the same name.
- Availability painting by dragging the mouse (just like when2meet), with Yes, Maybe, No and Erase brushes.
- Results page with an availability matrix, per-slot counts and aggregated score.
- Easy-to-copy event link to share with the group.
- Responsive design.

## Getting started with Docker

```bash
docker compose up -d
```

The app is available at http://localhost:5000. Data is stored in the `whentomeet-data` volume.

You can also use the image published on GitHub Container Registry:

```bash
docker run -d --name whentomeet2 -p 5000:5000 -v whentomeet-data:/data ghcr.io/theofficecat/whentomeet2:latest
```

## Local development

Requires Python 3.10 or later.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

By default it listens on `127.0.0.1:5000` and creates the `whentomeet.db` database at the project root.

## Configuration

| Variable      | Default         | Description                                      |
| ------------- | --------------- | ------------------------------------------------ |
| `DB_PATH`     | `whentomeet.db` | Path to the SQLite file.                         |
| `HOST`        | `127.0.0.1`     | Listening interface (only with `python app.py`). |
| `PORT`        | `5000`          | Port (only with `python app.py`).                |
| `FLASK_DEBUG` | disabled        | Set to `1` to enable Flask debug mode.           |

In Docker the app is served with gunicorn (`0.0.0.0:5000`).

## Routes

| Method | Route                             | Description                          |
| ------ | --------------------------------- | ------------------------------------ |
| GET    | `/`                               | Event creation form.                 |
| POST   | `/create`                         | Creates the event and redirects to it. |
| GET    | `/e/<event_id>`                   | Page to paint availability.          |
| GET    | `/e/<event_id>/results`           | Results page.                        |
| GET    | `/api/e/<event_id>/participant`   | Saved availability of a participant. |
| POST   | `/api/e/<event_id>/respond`       | Saves a participant's availability.  |
| GET    | `/api/e/<event_id>/results`       | Aggregated results as JSON.          |
| GET    | `/healthz`                        | Health check.                        |

## Project structure

```
app.py                  Flask app and SQLite schema
templates/              Jinja2 templates (base, index, event, results, 404)
static/                 Frontend CSS and JavaScript
Dockerfile              Production image (gunicorn)
docker-compose.yml      Deployment with a data volume
.github/workflows/ci.yml  CI: build, smoke test and publish to GHCR
```

## CI and publishing

The GitHub Actions workflow validates `docker-compose.yml`, builds the image, starts the container, checks `/healthz` and runs a smoke test covering event creation, a response and results. On pushes to the default branch (or `v*` tags) it publishes the image to `ghcr.io`.

## License

GPL-3.0. See the [LICENSE](LICENSE) file.
