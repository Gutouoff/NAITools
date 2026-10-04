import App from "./App";
import { ImageCopySupport } from "./image-copy";
import { ImagePasteSupport } from "./image-paste";
import { FavoritesNoticeSupport } from "./components/LocalFavorites";

export default function MainApp() {
  return <>
    <ImagePasteSupport />
    <ImageCopySupport />
    <FavoritesNoticeSupport />
    <App />
  </>;
}
