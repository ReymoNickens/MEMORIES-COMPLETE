-- Audit 29 Aug 2026: lock house tables from the browser key; constrain chat roles.

ALTER TABLE staff_messages DROP CONSTRAINT IF EXISTS staff_messages_to_role_check;
ALTER TABLE staff_messages ADD CONSTRAINT staff_messages_to_role_check
  CHECK (to_role IS NULL OR to_role IN (
    'owner', 'manager', 'door', 'waiter', 'bartender', 'kitchen', 'cashier', 'organiser',
    'hr', 'finance', 'front_office', 'dj', 'mc', 'event_manager'
  ));
