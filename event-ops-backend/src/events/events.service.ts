import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Event } from '../entities/event.entity';

@Injectable()
export class EventsService {
  constructor(
    @InjectRepository(Event)
    private readonly eventRepo: Repository<Event>,
  ) {}

  findAll() {
    return this.eventRepo.find({ order: { start_time: 'ASC' } });
  }

  async findOne(id: string) {
    const event = await this.eventRepo.findOne({ where: { event_id: id } });
    if (!event) throw new NotFoundException(`Event ${id} not found`);
    return event;
  }

  create(data: Partial<Event>) {
    if (!data.event_name || !data.start_time || !data.end_time) {
      throw new BadRequestException(
        'Event name, start time and end time are required / Vui lòng nhập tên sự kiện, thời gian bắt đầu và kết thúc',
      );
    }
    this.assertValidDateRange(data.start_time, data.end_time);
    const event = this.eventRepo.create(data);
    return this.eventRepo.save(event);
  }

  async update(id: string, data: Partial<Event>) {
    await this.findOne(id);
    this.assertValidDateRange(data.start_time, data.end_time);
    await this.eventRepo.update(id, data);
    return this.findOne(id);
  }

  // The end time must come after the start time (also enforced by a DB CHECK).
  private assertValidDateRange(start?: Date, end?: Date) {
    if (start && end && new Date(end) <= new Date(start)) {
      throw new BadRequestException(
        'End time must be after start time / Thời gian kết thúc phải sau thời gian bắt đầu',
      );
    }
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.eventRepo.delete(id);
    return { message: 'Event deleted' };
  }
}
