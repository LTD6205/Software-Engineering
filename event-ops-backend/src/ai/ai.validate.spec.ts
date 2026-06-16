import { validateActions } from './ai.validate';

describe('validateActions — custom status & links', () => {
  it('parses link_tasks with both refs', () => {
    const { actions, skipped } = validateActions([
      { action: 'link_tasks', task_ref: 'A', target_ref: 'B' },
    ]);
    expect(skipped).toBe(0);
    expect(actions[0]).toEqual({
      action: 'link_tasks',
      task_ref: 'A',
      target_ref: 'B',
    });
  });

  it('drops link_tasks missing a ref', () => {
    const { actions, skipped } = validateActions([
      { action: 'link_tasks', task_ref: 'A' },
    ]);
    expect(actions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('parses create_custom_status with name (color/event optional)', () => {
    const { actions } = validateActions([
      { action: 'create_custom_status', name: 'Blocked', color: '#f00' },
    ]);
    expect(actions[0]).toMatchObject({
      action: 'create_custom_status',
      name: 'Blocked',
      color: '#f00',
    });
  });

  it('drops create_custom_status with no name', () => {
    const { actions, skipped } = validateActions([
      { action: 'create_custom_status', color: '#f00' },
    ]);
    expect(actions).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('keeps an update that only sets custom_status', () => {
    const { actions, skipped } = validateActions([
      { action: 'update', task_ref: 'A', custom_status: 'Blocked' },
    ]);
    expect(skipped).toBe(0);
    expect(actions[0]).toEqual({
      action: 'update',
      task_ref: 'A',
      custom_status: 'Blocked',
    });
  });
});
