-- 0015: calendar runs (ADR-0020): many years, one date or a row of dates from representative day types
-- (worker/src/mobsim_worker/jobs/calendar.py). A project without rail service lines stores an empty network
-- and lines: only the expansion of the day figures runs.

ALTER TABLE simulation.run DROP CONSTRAINT run_kind_check;
ALTER TABLE simulation.run ADD CONSTRAINT run_kind_check CHECK (kind IN ('capacity', 'sweep', 'road', 'demand', 'calendar'));
