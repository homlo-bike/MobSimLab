-- 0025: the API's role reads and writes the live data cache of 0022, which was created without a grant, so every
-- read and write was refused ("permission denied for table data_cache") and nothing was cached (Damascus test,
-- bug 17).

GRANT SELECT, INSERT, UPDATE, DELETE ON project.data_cache TO mobsimlab_app;
