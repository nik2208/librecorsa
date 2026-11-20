-- Laps driven, for the boards' totals (cloudflare/api/stats.ts). Only a lap that beats the driver's best goes on a
-- board, so the boards alone can't say how many laps a circuit has seen: the usage report (cloudflare/api/usage.ts)
-- now also carries how many laps a stretch of driving completed, capped by its minutes, and they add up here with its
-- sessions and minutes. Like the rest of usage_daily, nothing here tells two players apart.
ALTER TABLE usage_daily ADD COLUMN laps INTEGER NOT NULL DEFAULT 0;

-- The totals of one circuit (and car) are read without going through every day of every circuit
CREATE INDEX usage_daily_track ON usage_daily (track_id, vehicle);
