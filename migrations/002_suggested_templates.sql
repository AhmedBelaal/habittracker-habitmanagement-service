INSERT INTO habits.habits_templates (id, type, name, description, category, tags, schedule, suggested_duration_days)
VALUES
  ('c535ec4d-a5ab-4b30-9a94-ff4e43b28e01', 'habit', 'Drink water', 'Have a glass of water with each meal.', 'health', ARRAY['water'], '{"type":"daily"}', NULL),
  ('c535ec4d-a5ab-4b30-9a94-ff4e43b28e02', 'habit', 'Read before bed', 'Read at least ten pages.', 'study', ARRAY['reading'], '{"type":"daily"}', NULL),
  ('c535ec4d-a5ab-4b30-9a94-ff4e43b28e03', 'challenge', 'Walk for 30 days', 'Take a short walk each day.', 'fitness', ARRAY['walking'], '{"type":"daily"}', 30);
