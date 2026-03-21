from tests.api_flows import (
    assert_admin_endpoints,
    assert_admin_permissions,
    assert_album_edge_cases,
    assert_album_endpoints,
    assert_auth_endpoints,
    assert_bulk_endpoints,
    assert_image_lifecycle_download_and_on_this_day_endpoints,
    assert_image_tag_search_and_favorite_endpoints,
    assert_image_upload_edge_cases,
)


def test_auth_endpoints(api):
    assert_auth_endpoints(api)


def test_image_tag_search_and_favorite_endpoints(api):
    assert_image_tag_search_and_favorite_endpoints(api)


def test_image_lifecycle_download_and_on_this_day_endpoints(api):
    assert_image_lifecycle_download_and_on_this_day_endpoints(api)


def test_image_upload_edge_cases(api):
    assert_image_upload_edge_cases(api)


def test_album_endpoints(api):
    assert_album_endpoints(api)


def test_album_edge_cases(api):
    assert_album_edge_cases(api)


def test_bulk_endpoints(api):
    assert_bulk_endpoints(api)


def test_admin_endpoints(api):
    assert_admin_endpoints(api)


def test_admin_permissions(api):
    assert_admin_permissions(api)
