import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// One undoable task change within an event (see migrations/2026-06-05_task_change_log.sql).
// 'edit'   → snapshot = { fields: { <changedKey>: <oldValue> } }
// 'delete' → snapshot = { task: { ...fields }, assignees: string[] }
// The app keeps only the 3 newest rows per event.
@Entity('task_change_log')
export class TaskChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  event_id: string;

  @Column({ nullable: true })
  task_id: string;

  @Column({ length: 10 })
  change_type: 'edit' | 'delete';

  @Column({ type: 'text', nullable: true })
  label: string;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ nullable: true })
  actor_user_id: string;

  @CreateDateColumn()
  created_at: Date;
}
