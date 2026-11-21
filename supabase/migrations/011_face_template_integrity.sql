-- 012 — face_templates: reject structurally invalid ciphertext at the DB tier
--
-- Found while testing: a placeholder `\x00` ciphertext was accepted, so a corrupt or
-- truncated template could be stored and would only fail later, inside the kiosk
-- match loop. Templates are AES-256-GCM over a 128-D int16 descriptor:
--   128 * 2 bytes = 256 bytes ciphertext, 12-byte IV, 16-byte auth tag.
-- Enforce the shape here; the GCM tag itself is verified by the server on read.
-- NOTE: applied to the project as `face_template_integrity`.

begin;

alter table face_templates
  add constraint face_templates_ciphertext_len check (octet_length(ciphertext) = 256) not valid,
  add constraint face_templates_iv_len check (octet_length(iv) = 12) not valid,
  add constraint face_templates_auth_tag_len check (octet_length(auth_tag) = 16) not valid,
  add constraint face_templates_dimension check (dimension = 128) not valid;

-- existing rows are validated by this statement; if any placeholder remains it must
-- be re-enrolled rather than trusted
alter table face_templates validate constraint face_templates_ciphertext_len;
alter table face_templates validate constraint face_templates_iv_len;
alter table face_templates validate constraint face_templates_auth_tag_len;
alter table face_templates validate constraint face_templates_dimension;

commit;
