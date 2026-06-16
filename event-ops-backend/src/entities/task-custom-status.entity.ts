import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

// A reusable, per-event custom progress label. Display-only: it is layered on top
// of the real status lifecycle (in_progress/completed/overdue) and is never read
// by the cron, priority automation, or AI status handling.
@Entity('task_custom_statuses')
export class TaskCustomStatus {
  @PrimaryGeneratedColumn('uuid')
  status_id: string;

  @Column()
  event_id: string;

  @Column({ length: 60 })
  name: string;

  @Column({ type: 'varchar', length: 20, nullable: true })
  color: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by: string | null;

  @CreateDateColumn()
  created_at: Date;
}
