import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('task_logs')
export class TaskLog {
  @PrimaryGeneratedColumn('uuid')
  log_id: string;

  @Column()
  task_id: string;

  @Column({ length: 50 })
  action_type: string;

  @Column({ type: 'jsonb', nullable: true })
  old_value: object;

  @Column({ type: 'jsonb', nullable: true })
  new_value: object;

  @Column({ length: 10 })
  actor_type: string;

  @Column({ nullable: true })
  actor_user_id: string;

  @Column({ nullable: true })
  ai_request_id: string;

  @CreateDateColumn()
  created_at: Date;
}