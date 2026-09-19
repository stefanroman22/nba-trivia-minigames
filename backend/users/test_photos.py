import base64
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.urls import reverse
from PIL import Image

from users import photos
from users.photos import InvalidPhoto, normalize_profile_photo, profile_photo_data_url
from users.tokens import issue_session_tokens

User = get_user_model()


def make_user(username="Baller23", email="baller@example.com"):
    """A signed-in user + access token, without going through the throttled signup
    endpoint (auth-signup is 10/hour and shared across the whole users test module)."""
    user = User.objects.create_user(username=username, email=email, password="Testpass123!")
    access = str(issue_session_tokens(user).access_token)
    return user, access


def image_bytes(img, fmt, **save_kwargs):
    out = BytesIO()
    img.save(out, format=fmt, **save_kwargs)
    return out.getvalue()


def decoded(out):
    return Image.open(BytesIO(out))


def assert_close(test, px, expected, tol=13):
    test.assertLess(max(abs(a - b) for a, b in zip(px, expected)), tol)


class NormalizePhotoTests(TestCase):
    def test_landscape_is_centre_cropped_to_square(self):
        img = Image.new("RGB", (900, 300))
        img.paste((255, 0, 0), (0, 0, 300, 300))
        img.paste((0, 255, 0), (300, 0, 600, 300))
        img.paste((0, 0, 255), (600, 0, 900, 300))
        out = normalize_profile_photo(image_bytes(img, "JPEG"))
        result = decoded(out)
        self.assertEqual(result.size, (256, 256))
        self.assertEqual(result.format, "JPEG")
        self.assertEqual(result.mode, "RGB")
        assert_close(self, result.getpixel((5, 128)), (0, 255, 0))
        assert_close(self, result.getpixel((250, 128)), (0, 255, 0))

    def test_portrait_is_centre_cropped_to_square(self):
        img = Image.new("RGB", (300, 900))
        img.paste((255, 0, 0), (0, 0, 300, 300))
        img.paste((0, 255, 0), (0, 300, 300, 600))
        img.paste((0, 0, 255), (0, 600, 300, 900))
        out = normalize_profile_photo(image_bytes(img, "JPEG"))
        result = decoded(out)
        assert_close(self, result.getpixel((128, 5)), (0, 255, 0))
        assert_close(self, result.getpixel((128, 250)), (0, 255, 0))

    def test_tiny_image_is_upscaled(self):
        img = Image.new("RGB", (8, 8), (255, 0, 0))
        out = normalize_profile_photo(image_bytes(img, "JPEG"))
        result = decoded(out)
        self.assertEqual(result.size, (256, 256))
        assert_close(self, result.getpixel((128, 128)), (255, 0, 0))

    def test_huge_image_is_downscaled(self):
        img = Image.new("L", (6000, 4000), 128)
        out = normalize_profile_photo(image_bytes(img, "JPEG"))
        result = decoded(out)
        self.assertEqual(result.size, (256, 256))
        self.assertLess(len(out), 48_000)

    def test_png_alpha_is_flattened_on_chip_background(self):
        img = Image.new("RGBA", (100, 100), (255, 0, 0, 0))
        out = normalize_profile_photo(image_bytes(img, "PNG"))
        result = decoded(out)
        assert_close(self, result.getpixel((50, 50)), (43, 43, 48))

    def test_large_transparent_png_is_flattened_on_chip_background(self):
        img = Image.new("RGBA", (2000, 1000), (255, 0, 0, 0))
        out = normalize_profile_photo(image_bytes(img, "PNG"))
        result = decoded(out)
        self.assertEqual(result.size, (256, 256))
        assert_close(self, result.getpixel((128, 128)), (43, 43, 48))

    def test_too_many_pixels_raises_invalid_photo(self):
        img = Image.new("RGB", (200, 200), (0, 0, 0))
        data = image_bytes(img, "JPEG")
        with patch.object(photos, "MAX_PHOTO_PIXELS", 10_000):
            with self.assertRaises(InvalidPhoto):
                normalize_profile_photo(data)

    def test_animated_gif_uses_first_frame(self):
        frame1 = Image.new("RGB", (100, 100), (255, 0, 0))
        frame2 = Image.new("RGB", (100, 100), (0, 0, 255))
        buf = BytesIO()
        frame1.save(buf, format="GIF", save_all=True, append_images=[frame2])
        out = normalize_profile_photo(buf.getvalue())
        result = decoded(out)
        assert_close(self, result.getpixel((128, 128)), (255, 0, 0))

    def test_exif_orientation_is_applied(self):
        img = Image.new("RGB", (512, 256))
        img.paste((255, 0, 0), (0, 0, 256, 256))
        img.paste((0, 0, 255), (256, 0, 512, 256))
        exif = Image.Exif()
        exif[0x0112] = 3  # 180 degrees
        out = normalize_profile_photo(image_bytes(img, "JPEG", exif=exif))
        result = decoded(out)
        assert_close(self, result.getpixel((10, 128)), (0, 0, 255))
        assert_close(self, result.getpixel((245, 128)), (255, 0, 0))

    def test_corrupt_bytes_raise_invalid_photo(self):
        with self.assertRaises(InvalidPhoto):
            normalize_profile_photo(b"not an image")
        valid_jpeg = image_bytes(Image.new("RGB", (50, 50), (0, 0, 0)), "JPEG")
        with self.assertRaises(InvalidPhoto):
            normalize_profile_photo(valid_jpeg[:120])

    def test_data_url_helper(self):
        self.assertIsNone(profile_photo_data_url(None))
        self.assertIsNone(profile_photo_data_url(b""))
        self.assertTrue(profile_photo_data_url(memoryview(b"\xff\xd8")).startswith("data:image/jpeg;base64,"))


class UpdateProfilePhotoTests(TestCase):
    def _upload(self, access, name, data, content_type):
        return self.client.post(
            reverse("update"),
            {"profile_photo": SimpleUploadedFile(name, data, content_type=content_type)},
            HTTP_AUTHORIZATION=f"Bearer {access}",
        )

    def test_requires_auth(self):
        res = self.client.post(
            reverse("update"),
            {"profile_photo": SimpleUploadedFile("x.png", image_bytes(Image.new("RGB", (10, 10)), "PNG"), content_type="image/png")},
        )
        self.assertEqual(res.status_code, 401)

    def test_upload_png_returns_normalized_user(self):
        user, access = make_user()
        data = image_bytes(Image.new("RGB", (640, 480), (10, 20, 30)), "PNG")
        res = self._upload(access, "x.png", data, "image/png")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "success")
        photo = body["user"]["profile_photo"]
        self.assertTrue(photo.startswith("data:image/jpeg;base64,"))
        raw = base64.b64decode(photo.split(",", 1)[1])
        result = decoded(raw)
        self.assertEqual(result.size, (256, 256))
        self.assertEqual(result.format, "JPEG")

        user.refresh_from_db()
        self.assertEqual(bytes(user.profile_photo_data), raw)

        res2 = self.client.get(reverse("get_user"), HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(res2.json()["user"]["profile_photo"], photo)

    def test_upload_replaces_previous_photo(self):
        user, access = make_user()
        red = image_bytes(Image.new("RGB", (100, 100), (255, 0, 0)), "JPEG")
        blue = image_bytes(Image.new("RGB", (100, 100), (0, 0, 255)), "JPEG")
        self._upload(access, "red.jpg", red, "image/jpeg")
        res = self._upload(access, "blue.jpg", blue, "image/jpeg")
        photo = res.json()["user"]["profile_photo"]
        raw = base64.b64decode(photo.split(",", 1)[1])
        result = decoded(raw)
        assert_close(self, result.getpixel((128, 128)), (0, 0, 255))

    def test_oversize_upload_rejected(self):
        user, access = make_user()
        big = SimpleUploadedFile("big.jpg", b"\xff" * (4 * 1024 * 1024 + 1), content_type="image/jpeg")
        res = self.client.post(
            reverse("update"), {"profile_photo": big}, HTTP_AUTHORIZATION=f"Bearer {access}"
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"], "Image is too large. Please choose one under 4 MB.")
        user.refresh_from_db()
        self.assertIsNone(user.profile_photo_data)

    def test_unreadable_upload_rejected(self):
        user, access = make_user()
        res = self._upload(access, "x.png", b"hello", "image/png")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"], "We couldn't read that image. Try a JPG, PNG, WebP or GIF.")
        user.refresh_from_db()
        self.assertIsNone(user.profile_photo_data)

    def test_no_file_rejected(self):
        user, access = make_user()
        res = self.client.post(reverse("update"), {}, HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()["error"], "No file provided")

    def test_only_owner_is_changed(self):
        user_a, access_a = make_user(username="PlayerA", email="a@example.com")
        user_b, _ = make_user(username="PlayerB", email="b@example.com")

        data = image_bytes(Image.new("RGB", (50, 50), (0, 255, 0)), "PNG")
        self._upload(access_a, "x.png", data, "image/png")

        user_b.refresh_from_db()
        self.assertIsNone(user_b.profile_photo_data)
