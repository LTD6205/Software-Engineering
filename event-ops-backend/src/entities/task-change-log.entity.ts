import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// One undoable OPERATION within an event (see migrations/2026-06-05_task_change_log.sql).
// A single manual action OR one AI command OR one batch (multi-select) action is
// ONE row; undo reverses everything it captured. The app keeps the 3 newest rows
// per event. snapshot holds whatever the operation did:
//   { created?:  string[]                                  // undo → delete these
//     deleted?:  { task: {...}, assignees: string[] }[]    // undo → re-create these
//     edited?:   { task_id: string, fields: {...} }[]      // undo → restore old fields
//     ungrouped?:{ task_id, group_id, group_title }[] }    // undo → put back in the group
// change_type is a free label/category for the Undo button (e.g. 'create',
// 'delete', 'edit', 'ungroup', 'batch').
@Entity('task_change_log')
export class TaskChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  event_id: string;

  @Column({ nullable: true })
  task_id: string;

  @Column({ length: 10 })
  change_type: string;

  @Column({ type: 'text', nullable: true })
  label: string;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ nullable: true })
  actor_user_id: string;

  @CreateDateColumn()
  created_at: Date;
}
