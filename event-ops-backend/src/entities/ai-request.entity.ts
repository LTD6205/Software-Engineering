import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('ai_requests')
export class AiRequest {
  @PrimaryGeneratedColumn('uuid')
  request_id: string;

  @Column()
  user_id: string;

  @Column({ type: 'text' })
  prompt: string;

  @Column({ type: 'jsonb', nullable: true })
  response: object;

  @Column({ default: 'pending' })
  status: string;

  @CreateDateColumn()
  created_at: Date;
}
