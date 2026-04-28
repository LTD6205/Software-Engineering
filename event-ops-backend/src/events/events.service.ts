import { Injectable, NotFoundException } from '@nestjs/common';
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
    const event = this.eventRepo.create(data);
    return this.eventRepo.save(event);
  }

  async update(id: string, data: Partial<Event>) {
    await this.findOne(id);
    await this.eventRepo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.eventRepo.delete(id);
    return { message: 'Event deleted' };
  }
}