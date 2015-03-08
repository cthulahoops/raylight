#version 130

in vec2 fragPos;
in vec2 UV;

// Ouput data
out vec3 color;

uniform sampler2D diffuse;
uniform sampler2D texture;
uniform vec3 drawColor;

void main()
{
    vec3 light = texture2D(diffuse, UV).rgb + vec3(0.03,0.03,0.05);

    if (drawColor == vec3(0,0,0)) {
        color = light * texture2D(texture, UV * 20).rgb;
    } else {
        color = light * drawColor.rgb;
    }
}
