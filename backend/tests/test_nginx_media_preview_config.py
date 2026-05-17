from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
NGINX_CONFIGS = [
    REPO_ROOT / "frontend" / "nginx.conf",
    REPO_ROOT / "frontend" / "nginx.e2e.conf",
]


def test_nginx_media_links_route_crawlers_to_embed_and_browsers_to_spa():
    for config_path in NGINX_CONFIGS:
        config = config_path.read_text()

        assert "map $http_user_agent $zukan_media_preview_crawler" in config
        assert "discordbot|twitterbot|facebookexternalhit|slackbot" in config
        assert 'location ~ "^/media/(?<zukan_media_id>' in config
        assert "rewrite ^ /api/v1/media/$zukan_media_id/embed last;" in config
        assert "try_files $uri $uri/ /index.html;" in config
        assert "proxy_set_header X-Forwarded-Host $zukan_forwarded_host;" in config
        assert "proxy_set_header X-Forwarded-Proto $zukan_forwarded_proto;" in config
