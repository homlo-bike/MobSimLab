-- 0017: whether the sign-in provider verified the user's e-mail (security review, alpha release). Sharing a project
-- by e-mail only finds people whose provider verified that address, so nobody can receive another person's
-- invitations by putting their e-mail on an account at a provider that lets people set any e-mail.
-- Existing users count as unverified until their next sign-in records what the provider says.

ALTER TABLE iam."user" ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
