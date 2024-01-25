#!/usr/bin/env python
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import re


def generate(roleH, roleIdl):
    input = open(roleIdl, "rt").read()
    roles = re.findall(r"const unsigned long ROLE_([A-Z_]+) = (\d+);", input)

    roleH.write(
        "/* THIS FILE IS AUTOGENERATED - DO NOT EDIT */\n"
        "/* Roles are defined in accessible/interfaces/nsIAccessibleRole.idl */\n\n"
        "#ifndef _role_h_\n"
        "#define _role_h_\n\n"
        "namespace mozilla {\n"
        "namespace a11y {\n"
        "namespace roles {\n\n"
        "enum Role {\n"
    )
    for name, num in roles:
        roleH.write(f"  {name} = {num},\n")
    lastName = roles[-1][0]
    roleH.write(
        f"  LAST_ROLE = {lastName}\n"
        "};\n\n"
        "}  // namespace roles\n\n"
        "typedef enum mozilla::a11y::roles::Role role;\n\n"
        "}  // namespace a11y\n"
        "}  // namespace mozilla\n\n"
        "#endif\n"
    )


# For debugging
if __name__ == "__main__":
    import sys

    generate(sys.stdout, "accessible/interfaces/nsIAccessibleRole.idl")
