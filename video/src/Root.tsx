import { Composition } from "remotion";
import { WiLensIntro, INTRO_FRAMES } from "./WiLensIntro";

export const Root: React.FC = () => (
  <Composition
    id="WiLensIntro"
    component={WiLensIntro}
    durationInFrames={INTRO_FRAMES}
    fps={30}
    width={1920}
    height={1080}
  />
);
