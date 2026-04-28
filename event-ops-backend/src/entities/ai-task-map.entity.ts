import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('ai_task_map')
export class AiTaskMap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  request_id: string;

  @Column()
  task_id: string;
}