# Keycloak themes

`widget-admin` is the sign-in theme of the admin interface (E4b.1 UX 17). One theme for every
realm: the client's name comes from the realm's `displayName`, the logo from the realm attribute
`clientLogoUrl` (the gateway's stable `/w/t/<tenant>/logo`). Romanian by default; the theme ships
its own `messages_ro.properties`, since Keycloak's own Romanian file covers only a few of the
strings (and spells "ă" with a caron).

Mounted at `/opt/keycloak/themes` (dev compose and CI). The template `template.ftl` is derived from
Keycloak's `keycloak.v2` login theme (Apache License 2.0); fonts: Inter (SIL OFL 1.1,
`login/resources/fonts/LICENSE-inter.txt`).
