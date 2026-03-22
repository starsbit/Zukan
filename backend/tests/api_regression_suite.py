from backend.tests.api_flows import (
    assert_admin_endpoints,
    assert_admin_permissions,
    assert_album_edge_cases,
    assert_album_endpoints,
    assert_auth_endpoints,
    assert_bulk_endpoints,
    assert_docs_require_authorization,
    assert_media_complex_query_regression,
    assert_media_lifecycle_download_and_on_this_day_endpoints,
    assert_media_tag_search_and_favorite_endpoints,
    assert_media_upload_edge_cases,
    assert_mixed_media_endpoints,
    assert_tag_management_endpoints,
)


def test_auth_endpoints(api):
    assert_auth_endpoints(api)


def test_docs_require_authorization(api):
    assert_docs_require_authorization(api)


def test_media_tag_search_and_favorite_endpoints(api):
    assert_media_tag_search_and_favorite_endpoints(api)


def test_media_lifecycle_download_and_on_this_day_endpoints(api):
    assert_media_lifecycle_download_and_on_this_day_endpoints(api)


def test_media_upload_edge_cases(api):
    assert_media_upload_edge_cases(api)


def test_media_complex_query_regression(api):
    assert_media_complex_query_regression(api)


def test_tag_management_endpoints(api):
    assert_tag_management_endpoints(api)


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


def test_mixed_media_endpoints(api):
    assert_mixed_media_endpoints(api)
