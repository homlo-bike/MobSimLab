-- 0010: opening a .mslab project file (ADR-0021) creates a project with the runs saved in the file, road runs
-- with their replay, so the API may now add a replay as well as the worker.

GRANT INSERT ON simulation.run_replay TO mobsimlab_app;
