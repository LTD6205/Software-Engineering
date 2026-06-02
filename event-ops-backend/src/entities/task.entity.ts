import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid')
  task_id: string;

  @Column()
  event_id: string;

  @Column({ length: 255 })
  task_name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ default: 'medium' })
  priority_label: string;

  @Column({ default: 0 })
  priority_score: number;

  @Column({ default: 'user' })
  priority_source: string;

  @Column({ default: 'in_progress' })
  status: string;

  @Column({ type: 'timestamp', nullable: true })
  start_time: Date;

  @Column({ type: 'timestamp', nullable: true })
  deadline: Date;

  @Column()
  created_by: string;

  // Non-null when this task is merged into a task group (shared span).
  @Column({ type: 'uuid', nullable: true })
  group_id: string | null;

  @CreateDateColumn()
  created_at: Date;
}
