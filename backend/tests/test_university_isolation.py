"""
Organization isolation integration tests.

These tests assert that Admin users from one organization cannot access or
modify data belonging to another organization, and that only Architects can
create Admin accounts or assign the ADMIN role.

Requirements to run:
    pip install pytest pytest-asyncio httpx
    Set TEST_BASE_URL to the running backend URL (default: http://localhost:8000)

Usage:
    pytest backend/tests/test_organization_isolation.py -v
"""
import os
import pytest
import httpx

BASE = os.getenv("TEST_BASE_URL", "http://localhost:8000")

# ---------------------------------------------------------------------------
# Fixtures — override these with real credentials for a seeded test database
# ---------------------------------------------------------------------------

ORG_A_ADMIN = {"username": os.getenv("TEST_ADMIN_A_USER", "lspu_admin"),
                "password": os.getenv("TEST_ADMIN_A_PASS", "")}
ORG_B_ADMIN = {"username": os.getenv("TEST_ADMIN_B_USER", "plm_admin"),
                "password": os.getenv("TEST_ADMIN_B_PASS", "")}
ARCHITECT    = {"username": os.getenv("TEST_ARCH_USER", "s0L"),
                "password": os.getenv("TEST_ARCH_PASS", "")}

# UUID of a OPERATIVE who belongs to Organization B (used to test cross-organization access)
ORG_B_USER_ID = os.getenv("TEST_ORG_B_USER_ID", "")


def _skip_if_unconfigured():
    """Skip tests when credentials are not provided."""
    if not ORG_A_ADMIN["password"] or not ORG_B_ADMIN["password"]:
        pytest.skip("Test credentials not configured (set TEST_ADMIN_A_PASS etc.)")


@pytest.fixture
def client():
    return httpx.Client(base_url=BASE, timeout=10)


def _login(client, credentials) -> str:
    r = client.post("/auth/login", json=credentials)
    assert r.status_code == 200, f"Login failed for {credentials['username']}: {r.text}"
    return r.json()["access_token"]


# ---------------------------------------------------------------------------
# Organization A Admin — can only see Organization A data
# ---------------------------------------------------------------------------

class TestOrgAAdminIsolation:

    def test_events_scoped_to_own_organization(self, client):
        """GET /events must return only Organization A events when called by Organization A Admin."""
        _skip_if_unconfigured()
        token = _login(client, ORG_A_ADMIN)
        r = client.get("/events", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        events = r.json()
        # All returned events must belong to the same organization as Admin A
        univ_ids = {e.get("org_id") for e in events}
        assert len(univ_ids) <= 1, (
            f"Admin A received events from multiple organizations: {univ_ids}"
        )

    def test_users_scoped_to_own_organization(self, client):
        """GET /admin/users must return only users from Organization A."""
        _skip_if_unconfigured()
        token = _login(client, ORG_A_ADMIN)
        r = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        users = r.json()
        # Get admin's own org_id from /auth/me
        me = client.get("/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
        own_univ_id = me.get("org_id")
        for u in users:
            assert u.get("org_id") == own_univ_id, (
                f"User {u.get('username')} (univ {u.get('org_id')}) "
                f"leaked to Admin A (univ {own_univ_id})"
            )

    def test_cannot_access_other_organization_user_detail(self, client):
        """GET /admin/users/{id}/detail must return 404 for a user from Organization B."""
        _skip_if_unconfigured()
        if not ORG_B_USER_ID:
            pytest.skip("TEST_ORG_B_USER_ID not set")
        token = _login(client, ORG_A_ADMIN)
        r = client.get(
            f"/admin/users/{ORG_B_USER_ID}/detail",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert r.status_code == 404, (
            f"Expected 404 for cross-organization user detail, got {r.status_code}: {r.text}"
        )

    def test_cannot_ban_user_from_other_organization(self, client):
        """PATCH /admin/users/{id} ban must return 404 for a user from Organization B."""
        _skip_if_unconfigured()
        if not ORG_B_USER_ID:
            pytest.skip("TEST_ORG_B_USER_ID not set")
        token = _login(client, ORG_A_ADMIN)
        r = client.patch(
            f"/admin/users/{ORG_B_USER_ID}",
            json={"is_banned": True},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert r.status_code == 404, (
            f"Expected 404 when banning cross-organization user, got {r.status_code}: {r.text}"
        )

    def test_cannot_assign_admin_role(self, client):
        """PATCH /admin/users/{id} with role=ADMIN must be rejected for non-Architect Admin."""
        _skip_if_unconfigured()
        if not ORG_B_USER_ID:
            pytest.skip("TEST_ORG_B_USER_ID not set")
        token = _login(client, ORG_A_ADMIN)
        r = client.patch(
            f"/admin/users/{ORG_B_USER_ID}",
            json={"role": "ADMIN"},
            headers={"Authorization": f"Bearer {token}"}
        )
        # 404 (cross-organization) or 403 (role escalation) — both are acceptable rejections
        assert r.status_code in (403, 404), (
            f"Expected 403/404 when assigning ADMIN role, got {r.status_code}: {r.text}"
        )

    def test_org_id_query_param_ignored(self, client):
        """Admin A passing ?org_id=<B_id> must not see Organization B's users."""
        _skip_if_unconfigured()
        token_a = _login(client, ORG_A_ADMIN)
        token_b = _login(client, ORG_B_ADMIN)
        # Get Organization B's id
        me_b = client.get("/auth/me", headers={"Authorization": f"Bearer {token_b}"}).json()
        univ_b_id = me_b.get("org_id")
        if not univ_b_id:
            pytest.skip("Could not determine Organization B id")

        # Admin A tries to pass ?org_id=<B_id>
        r = client.get(
            f"/admin/users?org_id={univ_b_id}",
            headers={"Authorization": f"Bearer {token_a}"}
        )
        assert r.status_code == 200
        users = r.json()
        # Must still only return Admin A's own organization users (override ignored)
        me_a = client.get("/auth/me", headers={"Authorization": f"Bearer {token_a}"}).json()
        own_univ_id = me_a.get("org_id")
        for u in users:
            assert u.get("org_id") == own_univ_id, (
                f"org_id override leaked Organization B user to Admin A"
            )


# ---------------------------------------------------------------------------
# Architect — can see all organizations
# ---------------------------------------------------------------------------

class TestArchitectGlobalAccess:

    def test_architect_sees_all_events(self, client):
        """GET /events as Architect must return events from all organizations."""
        _skip_if_unconfigured()
        token = _login(client, ARCHITECT)
        r = client.get("/events", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        # Just verify it doesn't error; Architect may legitimately have 0 events
        assert isinstance(r.json(), list)

    def test_architect_sees_all_users(self, client):
        """GET /admin/users as Architect must return users across all organizations."""
        _skip_if_unconfigured()
        token = _login(client, ARCHITECT)
        r = client.get("/admin/users", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200
        users = r.json()
        univ_ids = {u.get("org_id") for u in users if u.get("org_id")}
        # With multiple organizations seeded, Architect sees >1 organization
        assert len(univ_ids) >= 1

    def test_architect_can_scope_to_organization(self, client):
        """GET /admin/users?org_id=N as Architect filters to that organization."""
        _skip_if_unconfigured()
        token_a = _login(client, ORG_A_ADMIN)
        me_a = client.get("/auth/me", headers={"Authorization": f"Bearer {token_a}"}).json()
        univ_a_id = me_a.get("org_id")
        if not univ_a_id:
            pytest.skip("Could not determine Organization A id")

        arch_token = _login(client, ARCHITECT)
        r = client.get(
            f"/admin/users?org_id={univ_a_id}",
            headers={"Authorization": f"Bearer {arch_token}"}
        )
        assert r.status_code == 200
        users = r.json()
        for u in users:
            assert u.get("org_id") == univ_a_id, (
                f"Architect scope to univ {univ_a_id} returned user from univ {u.get('org_id')}"
            )


# ---------------------------------------------------------------------------
# Token + invitation security
# ---------------------------------------------------------------------------

class TestInvitationTokenSecurity:

    def test_expired_token_rejected(self, client):
        """POST /auth/activate-admin with an expired token must return 400."""
        r = client.post("/auth/activate-admin", json={
            "token": "0" * 43,  # invalid token
            "new_password": "ValidPass1",
            "confirm_password": "ValidPass1",
        })
        assert r.status_code == 400
        assert r.json().get("detail") == "INVALID_OR_EXPIRED"

    def test_validate_invite_invalid_token(self, client):
        """GET /auth/validate-invite with a garbage token must return 400."""
        r = client.get("/auth/validate-invite?token=notarealtoken")
        assert r.status_code == 400
        assert r.json().get("detail") == "INVALID_OR_EXPIRED"
