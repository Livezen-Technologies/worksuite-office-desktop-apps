// The WorkSuite logo, animated ("assemble": the squares build up, hold and come apart). The SVG keeps its own
// CSS animation, which runs in an <img>, and shows the still logo when reduced motion is asked for.
import logo from './worksuite-loader.svg';

export function Loader() {
  return (
    <div class="loader-page" role="status" aria-label="Loading">
      <img class="ws-loader" src={logo} width="64" height="64" alt="" />
    </div>
  );
}
