import unittest

from parser import parse_kml_overlay_file


class _Upload:
    def __init__(self, text):
        self._raw = text.encode("utf-8")

    def read(self):
        return self._raw


class ParserTransformerTests(unittest.TestCase):
    def test_linestring_dt_name_is_marked_as_transformer_candidate(self):
        upload = _Upload(
            """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>12-DT0025U</name>
      <description>1/0ACSRAWG 1/0ACSRAWG</description>
      <styleUrl>#PDLINE_PhaseA</styleUrl>
      <LineString>
        <coordinates>120.90570000002,15.6016100000026,0 120.90571565002,15.6016199580031,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>"""
        )

        result = parse_kml_overlay_file(upload)

        self.assertEqual(len(result["features"]), 1)
        self.assertEqual(result["features"][0]["geometry"], "linestring")
        self.assertTrue(result["features"][0]["is_transformer_candidate"])

    def test_linestring_dx_dt_name_is_not_marked_as_transformer_candidate(self):
        upload = _Upload(
            """<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>DX_12-DT0025U</name>
      <description>1/0ACSRAWG 1/0ACSRAWG</description>
      <styleUrl>#PDLINE_PhaseA</styleUrl>
      <LineString>
        <coordinates>120.90570000002,15.6016100000026,0 120.90571565002,15.6016199580031,0</coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>"""
        )

        result = parse_kml_overlay_file(upload)

        self.assertEqual(len(result["features"]), 1)
        self.assertEqual(result["features"][0]["geometry"], "linestring")
        self.assertFalse(result["features"][0]["is_transformer_candidate"])


if __name__ == "__main__":
    unittest.main()
