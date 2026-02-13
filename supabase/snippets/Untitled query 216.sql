  SELECT cron.schedule(
    'scheduling-reminders',
    '*/15 * * * *',
    $$SELECT process_scheduling_reminders()$$
  );