import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ProfileController, PublicProfileController } from './profile.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [InventoryModule],
  controllers: [ProfileController, PublicProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
