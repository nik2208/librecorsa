-- What drove each lap (keyboard, controller, wheel or touch), for the icon beside the driver's name on the boards.
-- Not part of a board's class: every device ranks on the same board. NULL on laps stored before it was kept, and on
-- laps from builds that don't send it; a driver's row takes the value of the lap that replaces it.
ALTER TABLE laps ADD COLUMN input TEXT;
