#version 130

in vec2 fragPos;

// Ouput data
out vec3 color;

uniform vec2 lightPos;
uniform vec3 lightColor;

void main()
{
	// Output color = red 
    vec2 d = fragPos - (lightPos * 0.0008);
	color = lightColor / (1 + 10 * (d.x * d.x + d.y * d.y));
}
