import { Module } from "@nestjs/common";
import { PhotonClient } from "../gateway/photon.client";
import { PlacesController } from "./places.controller";

/** Place search on the map (OpenStreetMap names through the Photon geocoder). */
@Module({
  controllers: [PlacesController],
  providers: [{ provide: PhotonClient, useFactory: () => new PhotonClient() }],
})
export class PlacesModule {}
