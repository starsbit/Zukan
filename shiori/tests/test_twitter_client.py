from __future__ import annotations

from shiori.app.twitter_client import build_canonical_tweet_url, parse_likes_response


def test_build_canonical_tweet_url():
    assert build_canonical_tweet_url("artist", "123") == "https://x.com/artist/status/123"


def test_parse_likes_response_extracts_media_and_cursor():
    payload = {
        "data": {
            "user": {
                "result": {
                    "timeline_v2": {
                        "timeline": {
                            "instructions": [
                                {
                                    "type": "TimelineAddEntries",
                                    "entries": [
                                        {
                                            "entryId": "tweet-1",
                                            "content": {
                                                "itemContent": {
                                                    "tweet_results": {
                                                        "result": {
                                                            "__typename": "Tweet",
                                                            "rest_id": "123",
                                                            "legacy": {
                                                                "created_at": "Wed Oct 10 20:19:24 +0000 2018",
                                                                "extended_entities": {
                                                                    "media": [
                                                                        {
                                                                            "type": "photo",
                                                                            "media_url_https": "https://pbs.twimg.com/media/a.jpg",
                                                                        },
                                                                        {
                                                                            "type": "video",
                                                                            "video_info": {
                                                                                "variants": [
                                                                                    {"url": "https://video.twimg.com/low.mp4", "content_type": "video/mp4", "bitrate": 256000},
                                                                                    {"url": "https://video.twimg.com/high.mp4", "content_type": "video/mp4", "bitrate": 832000},
                                                                                ]
                                                                            },
                                                                        },
                                                                    ]
                                                                },
                                                            },
                                                            "core": {
                                                                "user_results": {
                                                                    "result": {
                                                                        "legacy": {
                                                                            "screen_name": "artist"
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                        }
                                                    }
                                                }
                                            },
                                        },
                                        {
                                            "entryId": "cursor-bottom-1",
                                            "content": {"value": "CURSOR123"},
                                        },
                                    ],
                                }
                            ]
                        }
                    }
                }
            }
        }
    }

    tweets, cursor = parse_likes_response(payload)

    assert cursor == "CURSOR123"
    assert len(tweets) == 1
    tweet = tweets[0]
    assert tweet.tweet_id == "123"
    assert tweet.author_handle == "artist"
    assert tweet.tweet_url == "https://x.com/artist/status/123"
    assert len(tweet.media) == 2
    assert tweet.media[0].media_url.endswith("?name=orig")
    assert tweet.media[1].media_url == "https://video.twimg.com/high.mp4"


def test_parse_likes_response_ignores_tweets_without_media():
    payload = {
        "data": {
            "user": {
                "result": {
                    "timeline_v2": {
                        "timeline": {
                            "instructions": [
                                {
                                    "entries": [
                                        {
                                            "content": {
                                                "itemContent": {
                                                    "tweet_results": {
                                                        "result": {
                                                            "__typename": "Tweet",
                                                            "rest_id": "123",
                                                            "legacy": {},
                                                            "core": {
                                                                "user_results": {
                                                                    "result": {"legacy": {"screen_name": "artist"}}
                                                                }
                                                            },
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    ]
                                }
                            ]
                        }
                    }
                }
            }
        }
    }

    tweets, cursor = parse_likes_response(payload)

    assert tweets == []
    assert cursor is None
