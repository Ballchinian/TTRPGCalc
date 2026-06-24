# API Endpoints

This document describes the Pathfinder 2e Combat Calculator backend API. All routes are prefixed with `/api`.

## Authentication

Endpoints marked with 🔒 require a **Bearer access token** in the `Authorization` header.

The token is obtained from `/api/auth/login` and refreshed via `/api/auth/refresh`. The authentication and session routes additionally rely on an httpOnly **refresh-token cookie**. Authentication and import routes are rate limited.

---

# Authentication & Session

## POST `/api/auth/register`

Create a new account.

### Input

* Name
* Email
* Password (8-128 characters)

### Returns

* The created user (id, name, email)

---

## POST `/api/auth/login`

Authenticate with email and password.

### Returns

* Access token
* User (name, email)
* Sets the httpOnly refresh-token cookie

### Notes

* Accounts created via a social provider (no password) are rejected here and must use their provider's sign-in.

---

## POST `/api/auth/google`

Sign in with Google. The client obtains a Google ID token (via the Google Identity button) and posts it here.

### Input

* `credential`: the Google ID token (JWT)

### Effects

* Verifies the token's signature, audience (`GOOGLE_CLIENT_ID`), and expiry.
* Requires a Google-verified email; links to an existing account with the same email, or creates a new one.

### Returns

* Access token
* User (name, email)
* Sets the httpOnly refresh-token cookie

### Notes

* Rate limited. The client `VITE_GOOGLE_CLIENT_ID` and the server `GOOGLE_CLIENT_ID` must be the same OAuth web client ID.

---

## POST `/api/auth/facebook`

Sign in with Facebook. The client obtains a Facebook user access token (via the Facebook JS SDK) and posts it here.

### Input

* `access_token`: the Facebook user access token

### Effects

* Validates the token against the app (`debug_token`) and reads the profile (Graph `/me`).
* Requires an email from Facebook; links to an existing account with the same email, or creates a new one.

### Returns

* Access token
* User (name, email)
* Sets the httpOnly refresh-token cookie

### Notes

* Rate limited. Requires `FACEBOOK_APP_ID` + `FACEBOOK_APP_SECRET` on the server and `VITE_FACEBOOK_APP_ID` on the client.

---

## POST `/api/auth/refresh`

Exchange the refresh-token cookie for a new access token.

### Effects

* Rotates the refresh token
* Returns a fresh access token

---

## POST `/api/auth/logout`

Invalidate the current session.

### Effects

* Clears the server-side refresh token
* Clears the refresh-token cookie

---

## POST `/api/auth/request-reset-password`

Request a password-reset email.

### Input

* Email

### Notes

* Always returns success, even when the email is unknown, to prevent account enumeration.
* The reset link contains a single-use token that expires in one hour.

---

## POST `/api/auth/confirm-reset-password`

Complete a password reset.

### Input

* Reset token
* New password (8-128 characters)

### Effects

* Updates the password
* Invalidates all active sessions

---

# Characters 🔒

## GET `/api/characters`

Retrieve all characters owned by the current user.

---

## POST `/api/characters`

Create a character.

### Input

* Name, stats, resistances, weaknesses, immunities, class option
* Optional portrait image URL (must be a Cloudinary URL)

---

## PUT `/api/characters/:id`

Update a character owned by the current user.

---

## DELETE `/api/characters/:id`

Delete a character owned by the current user.

---

## POST `/api/characters/upload`

Upload a character portrait.

### Input

* An image file (`image` field, JPEG or PNG, up to 5 MB)

### Returns

* The hosted Cloudinary image URL

---

# Actions - Weapons & Spells 🔒

## GET `/api/actions`

Retrieve the current user's actions.

### Returns

* Weapons
* Spells

---

## POST `/api/actions`

Create a weapon or spell.

---

## PUT `/api/actions/:id`

Update an action owned by the current user.

---

## DELETE `/api/actions/:id`

Delete an action owned by the current user.

---

# Game Data 🔒

Static reference data used to build characters and actions. Served under the actions router.

## GET `/api/actions/globalActions`

Global actions available to every character (Grapple, Trip, Demoralize, Stand, Escape).

---

## GET `/api/actions/featureActions`

Actions granted by class features and styles (Rage, Dirty Trick, Hunt Prey, and so on).

---

## GET `/api/actions/effects`

All built-in conditions and effects, with their levels, default durations, and descriptions.

---

## GET `/api/actions/globalOffGuardEffects`

The set of conditions that impose off-guard.

---

## GET `/api/actions/traitModules`

Weapon and spell trait definitions (label, render data, and effects).

---

## GET `/api/actions/damageTypes`

The list of supported damage types.

---

# Battle Resolution 🔒

## POST `/api/battles`

Resolve a single action against one or more targets.

### Input

* Active actor
* Target characters (up to 20)
* Action (a global action key, or a weapon/spell referenced by id)
* Dice mode (`avg`, `luck`, or `choose`)
* Offensive and defensive bonuses
* Optional critical-specialization group, strike rider, and versatile damage type

### Returns

* The updated active actor
* The updated target characters
* A formatted combat log
* Per-target action statistics
* Pending outcomes (in `choose` mode)

### Notes

* The action is refetched from the database by id and owner, so client-supplied action payloads cannot reach the resolver.
* Bonus values are clamped, and feature/style actions are gated by the actor's class.

---

# Saved Battles 🔒

A user may keep up to five saved battles.

## GET `/api/saved-battles`

List the user's saved battles (metadata only, name and timestamps).

---

## POST `/api/saved-battles`

Save the current battle.

### Input

* Name
* Battle data (parties and recap history)

### Notes

* Rejected once the five-battle limit is reached.

---

## GET `/api/saved-battles/:id`

Load a saved battle, including its full data.

---

## PUT `/api/saved-battles/:id`

Overwrite an existing saved battle without consuming another slot.

---

## DELETE `/api/saved-battles/:id`

Delete a saved battle.

---

# Import 🔒

## GET `/api/import/pathbuilder/:code`

Fetch a Pathbuilder 2e character export by its numeric code.

### Notes

* A server side proxy is needed because Pathbuilder sends no CORS headers.
* The code is validated as a 4-8 digit number; the upstream host is fixed.
* If the proxy fails, the frontend falls back to pasting the exported JSON.
* Rate limited.
