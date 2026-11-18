-- 0020: the provider's ID token of a signed-in session, kept only to send as `id_token_hint` when the person signs
-- out. Without it, providers such as Authentik stop on their own "You've logged out" page instead of returning to
-- MobSimLab (RP-Initiated Logout 1.0 lets a provider ignore `post_logout_redirect_uri` without a hint).
-- It is cleared when the session is revoked. An ID token is a signed statement of who signed in, not an access
-- token: it cannot call the provider's APIs.

ALTER TABLE iam.session ADD COLUMN id_token text CHECK (id_token IS NULL OR length(id_token) <= 16384);
