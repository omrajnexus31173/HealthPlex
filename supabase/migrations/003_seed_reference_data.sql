-- HEALTHPLEX :: 003 reference data (no students, no fake attendance)
insert into departments (name, code, faculty) values
  ('Computer Science & Engineering','CSE','Faculty of Engineering & Technology'),
  ('Information Technology','IT','Faculty of Engineering & Technology'),
  ('Electronics & Communication','EC','Faculty of Engineering & Technology'),
  ('Mechanical Engineering','ME','Faculty of Engineering & Technology'),
  ('Chemical Engineering','CHE','Faculty of Engineering & Technology'),
  ('Civil Engineering','CE','Faculty of Engineering & Technology'),
  ('Biotechnology','BT','Faculty of Science'),
  ('Life Sciences','LS','Faculty of Science'),
  ('Management Studies','MBA','Faculty of Management'),
  ('Pharmacy','PHARM','Faculty of Pharmacy')
on conflict (code) do nothing;

insert into gym_shifts (name, start_time, end_time, description) values
  ('Morning Shift','06:00','12:00','Opening supervision and morning training support'),
  ('Afternoon Shift','12:00','17:00','Mid-day floor supervision'),
  ('Evening Shift','17:00','22:00','Peak hour supervision and closing')
on conflict do nothing;

-- no seed accounts: every account is created through the admin invitation flow,
-- which keeps credentials out of the repository and out of SQL history.
