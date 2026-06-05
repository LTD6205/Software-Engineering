import { isActionAllowedForRole, AI_ACTION_ROLES } from './ai.authz';

describe('isActionAllowedForRole', () => {
  it('lets a manager do task actions but not event actions', () => {
    expect(isActionAllowedForRole('manager', 'create')).toBe(true);
    expect(isActionAllowedForRole('manager', 'delete')).toBe(true);
    expect(isActionAllowedForRole('manager', 'create_event')).toBe(false);
  });

  it('lets an organizer do event actions but not task actions', () => {
    expect(isActionAllowedForRole('organizer', 'create_event')).toBe(true);
    expect(isActionAllowedForRole('organizer', 'add_event_manager')).toBe(true);
    expect(isActionAllowedForRole('organizer', 'create')).toBe(false);
  });

  it('lets an admin do everything in the catalog', () => {
    for (const action of Object.keys(AI_ACTION_ROLES)) {
      expect(isActionAllowedForRole('admin', action)).toBe(true);
    }
  });

  it('denies an unknown action for everyone', () => {
    expect(isActionAllowedForRole('admin', 'nuke')).toBe(false);
  });
});
