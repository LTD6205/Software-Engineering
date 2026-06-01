import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // GET /api/users — manager only
  @Get()
  @Roles('manager', 'admin')
  findAll() {
    return this.usersService.findAll();
  }

  // GET /api/users/:id — manager only
  @Get(':id')
  @Roles('manager', 'admin')
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  // POST /api/users — manager creates staff account
  @Post()
  @Roles('manager', 'admin')
  create(
    @Body()
    body: {
      name: string;
      email: string;
      password: string;
      role?: string;
    },
  ) {
    return this.usersService.create(body);
  }

  // PUT /api/users/:id — manager updates staff
  @Put(':id')
  @Roles('manager', 'admin')
  update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      role?: string;
      is_active?: boolean;
      password?: string;
    },
  ) {
    return this.usersService.update(id, body);
  }

  // PUT /api/users/:id/deactivate — manager deactivates staff
  @Put(':id/deactivate')
  @Roles('manager', 'admin')
  deactivate(@Param('id') id: string) {
    return this.usersService.deactivate(id);
  }
}
